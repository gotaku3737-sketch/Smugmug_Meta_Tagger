@local-export
Feature: Local Tag Manifest & File Exports
  As a user
  I want my photo tags saved to portable local files (JSON, CSV, and XMP sidecars)
  So that I can back up, audit, re-import, and share tags with external photo managers

  Scenario: Auto-saving tags to a local portable JSON manifest
    Given auto-save tag manifest is enabled
    And an album "Hawaii 2026" ("album_xyz") has an image "photo_abc123" ("IMG_0042.JPG")
    And "photo_abc123" has an approved tag for "Jane Smith" with confidence 0.85 and bounding box 0.12, 0.18, 0.22, 0.30
    When the local tag manifest is synced to "tags.json"
    Then "tags.json" should exist with schemaVersion 1
    And "tags.json" should record "Jane Smith" for "photo_abc123" with approved true and bounding box 0.12, 0.18, 0.22, 0.30

  Scenario: Re-importing a local JSON manifest restores tag state
    Given a valid "tags.json" manifest exists with 2 tagged people across 2 images
    And the local tag store is empty
    When the user imports "tags.json"
    Then the local tag store should contain all 2 restored tag records with their approval and upload status

  Scenario: Exporting tags to CSV for spreadsheet review
    Given an album "Hawaii 2026" ("album_xyz") has an image "photo_abc123" ("IMG_0042.JPG")
    And "photo_abc123" has an approved tag for "Jane Smith" with confidence 0.85 and bounding box 0.12, 0.18, 0.22, 0.30
    When the user exports tags to CSV "smugmug_tags.csv"
    Then "smugmug_tags.csv" should contain the header "album_title,album_key,filename,image_key,person_name,confidence,approved,uploaded,tagged_at,web_uri"
    And "smugmug_tags.csv" should include a row for "photo_abc123" and "Jane Smith"

  Scenario: Exporting XMP sidecar files with keywords and MWG face regions
    Given an album "Hawaii 2026" ("album_xyz") has an image "photo_abc123" ("IMG_0042.JPG")
    And "photo_abc123" has an approved tag for "Jane Smith" with confidence 0.85 and bounding box 0.12, 0.18, 0.22, 0.30
    When the user exports XMP sidecar files with prefix "Person:"
    Then an XMP sidecar file "IMG_0042.JPG.xmp" should be created
    And the XMP sidecar should include dc:subject keyword "Person:Jane Smith"
    And the XMP sidecar should include an MWG face region for "Jane Smith"
