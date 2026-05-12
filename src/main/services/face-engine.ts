// ============================================================
// Face Detection & Recognition Engine
// face-api.js (@vladmandic/face-api) + @napi-rs/canvas
// ============================================================

import path from 'node:path';
import fs from 'node:fs';
import type { DatabaseService } from './database';
import type { DetectedFace, FaceMatch, FaceDetectionProgress, BoundingBox } from '../../shared/types';
import { sleep } from '../../shared/utils';

// We defer imports until after canvas patch is applied
let faceapi: typeof import('@vladmandic/face-api');

export class FaceEngine {
  private db: DatabaseService;
  private modelsDir: string;
  private isLoaded = false;
  private threshold: number;
  private progressCallback?: (progress: FaceDetectionProgress) => void;

  constructor(db: DatabaseService, modelsDir: string, threshold = 0.6) {
    this.db = db;
    this.modelsDir = modelsDir;
    this.threshold = threshold;
  }

  setThreshold(threshold: number): void {
    this.threshold = threshold;
  }

  onProgress(callback: (progress: FaceDetectionProgress) => void): void {
    this.progressCallback = callback;
  }

  // -----------------------------------------------------------
  // Model Loading
  // -----------------------------------------------------------

  async loadModels(): Promise<void> {
    if (this.isLoaded) return;

    // Patch canvas environment for face-api.js to work in Node.js
    // @napi-rs/canvas provides createCanvas and loadImage
    const { createCanvas, loadImage } = await import('@napi-rs/canvas');

    // Monkey-patch the global environment so face-api can use canvas
    const globalAny = global as Record<string, unknown>;
    globalAny.createImageData = (width: number, height: number) => {
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      return ctx.createImageData(width, height);
    };

    // Import face-api after patching
    faceapi = await import('@vladmandic/face-api');

    // Set the node-canvas environment
    const env = faceapi.env as Record<string, unknown>;
    if (typeof env.monkeyPatch === 'function') {
      (env.monkeyPatch as (config: unknown) => void)({ Canvas: createCanvas, Image: class {} });
    }

    if (!fs.existsSync(this.modelsDir)) {
      throw new Error(`Models directory not found: ${this.modelsDir}`);
    }

    console.log('[FaceEngine] Loading models from:', this.modelsDir);

    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromDisk(this.modelsDir),
      faceapi.nets.faceLandmark68Net.loadFromDisk(this.modelsDir),
      faceapi.nets.faceRecognitionNet.loadFromDisk(this.modelsDir),
    ]);

    this.isLoaded = true;
    console.log('[FaceEngine] Models loaded successfully');
  }

  // -----------------------------------------------------------
  // Face Detection — process a single image file
  // -----------------------------------------------------------

  async detectFaces(imagePath: string): Promise<DetectedFace[]> {
    await this.loadModels();

    const { loadImage, createCanvas } = await import('@napi-rs/canvas');

    if (!fs.existsSync(imagePath)) {
      throw new Error(`Image file not found: ${imagePath}`);
    }

    const img = await loadImage(imagePath);
    const canvas = createCanvas(img.width, img.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img as Parameters<typeof ctx.drawImage>[0], 0, 0);

    // Run full detection pipeline: detect → landmarks → descriptors
    const detections = await faceapi
      .detectAllFaces(canvas as unknown as Parameters<typeof faceapi.detectAllFaces>[0], new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
      .withFaceLandmarks()
      .withFaceDescriptors();

    const W = img.width;
    const H = img.height;

    return detections.map(d => ({
      bbox: {
        // Normalize bounding box to 0–1 range for storage
        x: d.detection.box.x / W,
        y: d.detection.box.y / H,
        width: d.detection.box.width / W,
        height: d.detection.box.height / H,
      },
      descriptor: new Float32Array(d.descriptor),
      landmarks: d.landmarks.positions.map(p => [p.x / W, p.y / H]),
    }));
  }

  // -----------------------------------------------------------
  // Batch Face Detection — process all medium-res images in an album
  // -----------------------------------------------------------

  async detectInAlbum(albumKey: string): Promise<void> {
    await this.loadModels();

    const images = this.db.getImagesByAlbum(albumKey);
    const toProcess = images.filter(img => img.mediumDownloaded && !img.facesDetected && img.mediumPath);

    const total = toProcess.length;
    let completed = 0;
    let totalFacesFound = 0;
    const BATCH_SIZE = 5;

    console.log(`[FaceEngine] Processing ${total} images in album ${albumKey}`);

    for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
      const batch = toProcess.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async img => {
        try {
          const faces = await this.detectFaces(img.mediumPath!);
          this.db.markFacesDetected(img.imageKey, faces.length);

          if (faces.length > 0) {
            totalFacesFound += faces.length;
          }
        } catch (err) {
          console.error(`[FaceEngine] Failed to process ${img.imageKey}:`, err);
          // Mark as processed anyway to avoid infinite retry loops
          this.db.markFacesDetected(img.imageKey, 0);
        }

        completed++;
        this.progressCallback?.({
          completed,
          total,
          currentImage: img.filename,
          facesFound: totalFacesFound,
        });
      }));

      // Yield to event loop between batches to keep UI responsive
      await sleep(50);
    }

    console.log(`[FaceEngine] Done. ${completed} images processed, ${totalFacesFound} faces found.`);
  }

  // -----------------------------------------------------------
  // Training — store a labeled descriptor in the DB
  // -----------------------------------------------------------

  async trainFace(
    imageKey: string,
    imagePath: string,
    bbox: BoundingBox,
    personName: string
  ): Promise<void> {
    await this.loadModels();

    const faces = await this.detectFaces(imagePath);

    // Find the detected face whose bbox best overlaps with the provided bbox
    const bestFace = this.findBestMatchingFace(faces, bbox);

    if (!bestFace) {
      // Fallback: if we can't detect a face in the crop, store a zero descriptor
      // (the user manually labelled it, so we still save the training sample)
      console.warn(`[FaceEngine] No face detected at bbox for ${imageKey}, using zeros`);
      const personId = this.db.addPerson(personName);
      this.db.addFaceDescriptor(personId, new Float32Array(128), imageKey, bbox);
      return;
    }

    const personId = this.db.addPerson(personName);
    this.db.addFaceDescriptor(personId, bestFace.descriptor, imageKey, bbox);

    console.log(`[FaceEngine] Trained face for "${personName}" from image ${imageKey}`);
  }

  // -----------------------------------------------------------
  // Recognition — match detected faces against trained descriptors
  // -----------------------------------------------------------

  async runAutoTagger(): Promise<void> {
    await this.loadModels();

    const allDescriptors = this.db.getAllDescriptors();

    if (allDescriptors.length === 0) {
      console.warn('[FaceEngine] No training data found. Cannot auto-tag.');
      return;
    }

    // Build labelled descriptors grouped by person
    const labeledDescriptors = this.buildLabeledDescriptors(allDescriptors);
    const faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, this.threshold);

    // Get all images with detected faces that haven't been tagged yet
    const images = this.db.getUntaggedImagesWithFaces
      ? this.db.getUntaggedImagesWithFaces()
      : [];

    // Also process images with faces detected but no detected_people yet
    const unprocessed = this.db.getImagesWithFacesForMatching();

    console.log(`[FaceEngine] Running auto-tagger on ${unprocessed.length} images`);

    for (const img of unprocessed) {
      if (!img.mediumPath || !img.mediumDownloaded) continue;

      try {
        const faces = await this.detectFaces(img.mediumPath);
        if (faces.length === 0) continue;

        const matches: FaceMatch[] = faces.map(face => {
          const match = faceMatcher.findBestMatch(face.descriptor);
          const distance = match.distance;
          const confidence = Math.max(0, Math.min(1, 1 - distance / this.threshold));

          return {
            personName: match.label === 'unknown' ? 'Unknown' : match.label,
            distance,
            confidence,
            bbox: face.bbox,
          };
        }).filter(m => m.personName !== 'Unknown');

        if (matches.length > 0) {
          this.db.markFacesDetected(img.imageKey, faces.length, matches);
        }
      } catch (err) {
        console.error(`[FaceEngine] Auto-tag failed for ${img.imageKey}:`, err);
      }

      // Yield between images
      await sleep(10);
    }

    console.log('[FaceEngine] Auto-tagging complete.');
  }

  // -----------------------------------------------------------
  // Approve matches — finalize person associations for an image
  // -----------------------------------------------------------

  approveMatches(imageKey: string, approvedNames: string[]): void {
    const image = this.db.getImage(imageKey);
    if (!image || !image.detectedPeople) return;

    // Filter detected people to only approved names
    const approved = image.detectedPeople.filter(p => approvedNames.includes(p.personName));
    this.db.updateDetectedPeople(imageKey, approved);
  }

  // -----------------------------------------------------------
  // Private Helpers
  // -----------------------------------------------------------

  private findBestMatchingFace(faces: DetectedFace[], targetBbox: BoundingBox): DetectedFace | undefined {
    if (faces.length === 0) return undefined;
    if (faces.length === 1) return faces[0];

    // Find face with highest IoU overlap with the target bbox
    let bestFace = faces[0];
    let bestIoU = this.computeIoU(faces[0].bbox, targetBbox);

    for (let i = 1; i < faces.length; i++) {
      const iou = this.computeIoU(faces[i].bbox, targetBbox);
      if (iou > bestIoU) {
        bestIoU = iou;
        bestFace = faces[i];
      }
    }

    return bestFace;
  }

  private computeIoU(a: BoundingBox, b: BoundingBox): number {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);

    const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    if (intersection === 0) return 0;

    const aArea = a.width * a.height;
    const bArea = b.width * b.height;
    const union = aArea + bArea - intersection;

    return intersection / union;
  }

  private buildLabeledDescriptors(
    allDescriptors: { personId: number; personName: string; descriptor: Float32Array }[]
  ): InstanceType<typeof faceapi.LabeledFaceDescriptors>[] {
    // Group descriptors by person
    const personMap = new Map<string, Float32Array[]>();

    for (const d of allDescriptors) {
      const existing = personMap.get(d.personName) || [];
      existing.push(d.descriptor);
      personMap.set(d.personName, existing);
    }

    return Array.from(personMap.entries()).map(
      ([name, descriptors]) => new faceapi.LabeledFaceDescriptors(name, descriptors)
    );
  }
}
