Feature: Local Image Tag Storage
  As a user
  I want tag information for each photo stored locally in a normalized table
  So that I can query, filter, and audit tags without relying on SmugMug's API

  Background:
    Given the local SQLite database is initialized
    And the "image_tags" table exists with columns:
      | column       | type    | notes                            |
      | id           | INTEGER | primary key                      |
      | image_key    | TEXT    | references images(image_key)     |
      | person_name  | TEXT    | the recognized person's name     |
      | confidence   | REAL    | face match confidence (0.0-1.0)  |
      | bbox_x       | REAL    | bounding box x                   |
      | bbox_y       | REAL    | bounding box y                   |
      | bbox_w       | REAL    | bounding box width               |
      | bbox_h       | REAL    | bounding box height              |
      | approved     | INTEGER | 0=auto, 1=manually approved      |
      | uploaded     | INTEGER | 0=pending, 1=pushed to SmugMug   |
      | tagged_at    | DATETIME| when the tag was created         |

  # -----------------------------------------------------------
  # Writing Tags
  # -----------------------------------------------------------

  Scenario: Auto-tagger stores recognized people as individual tag rows
    Given an image "photo_abc123" has been scanned and 2 faces detected
    And the auto-tagger recognizes "Jane Smith" with 85% confidence
    And the auto-tagger recognizes "John Doe" with 62% confidence
    When the auto-tagger saves the results
    Then the "image_tags" table should contain 2 rows for "photo_abc123"
    And one row should have person_name "Jane Smith" and confidence 0.85
    And one row should have person_name "John Doe" and confidence 0.62
    And both rows should have approved = 0 and uploaded = 0

  Scenario: Manually approving a tag marks it as approved
    Given the "image_tags" table has an unapproved tag for "photo_abc123" and "Jane Smith"
    When the user approves the tag for "Jane Smith" on "photo_abc123"
    Then the tag row should have approved = 1

  Scenario: Uploading a tag to SmugMug marks it as uploaded
    Given an approved tag exists for "photo_abc123" and "Jane Smith"
    When the tag is successfully uploaded to SmugMug
    Then the tag row should have uploaded = 1
    And the "tagged_at" timestamp should be set

  Scenario: Re-running auto-tagger on an already-tagged image replaces old tags
    Given "photo_abc123" already has tag rows for "Jane Smith" and "Old Person"
    When the auto-tagger runs again on "photo_abc123"
    Then old tag rows for "photo_abc123" should be deleted
    And new tag rows should be inserted with the latest recognition results

  # -----------------------------------------------------------
  # Querying Tags
  # -----------------------------------------------------------

  Scenario: Retrieve all photos tagged with a specific person
    Given the "image_tags" table contains tags across multiple images
    And "Jane Smith" is tagged in "photo_abc123" and "photo_def456"
    When the user queries all photos tagged with "Jane Smith"
    Then the result should include "photo_abc123" and "photo_def456"
    And the result should not include images that only have other people tagged

  Scenario: Retrieve all unuploaded tags for upload
    Given the "image_tags" table has 3 approved tags with uploaded = 0
    And 2 tags with uploaded = 1
    When the system fetches tags pending upload
    Then only the 3 unuploaded tags should be returned

  Scenario: Filter tags by confidence threshold
    Given the "image_tags" table has tags with varying confidence scores
    When the user filters tags with confidence >= 0.7
    Then only tags with confidence 0.7 or higher should be returned

  Scenario: Retrieve a full tag summary for a single image
    Given "photo_abc123" has 2 tag rows: "Jane Smith" (approved) and "John Doe" (unapproved)
    When the system fetches the tag summary for "photo_abc123"
    Then the summary should list both people with their approval and upload status

  # -----------------------------------------------------------
  # Data Integrity
  # -----------------------------------------------------------

  Scenario: Deleting an image also deletes its tags (cascade)
    Given "photo_abc123" has 2 rows in "image_tags"
    When the image "photo_abc123" is deleted from the "images" table
    Then the "image_tags" rows for "photo_abc123" should also be deleted

  Scenario: Deleting a person does not delete their image tags
    Given "Jane Smith" has been recognized in 3 photos and stored in "image_tags"
    When the person "Jane Smith" is deleted from the "people" table
    Then the "image_tags" rows for "Jane Smith" should still exist
    And the person_name column should retain the value "Jane Smith"
