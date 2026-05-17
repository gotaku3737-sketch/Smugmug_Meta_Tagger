Feature: Face Scanning
  As a user
  I want to scan my albums for faces
  So that the app can detect and prepare faces for labeling

  Scenario: Scanning an Album for Faces
    Given the user has an album with downloaded thumbnails
    When the user clicks "Scan Faces" on the album
    Then the app should download medium-resolution images for the album
    And the app should run face detection on the images in batches
    And the face bounding boxes and 128-dimensional embeddings should be stored in the database
    And the user should see progress updated in real time
