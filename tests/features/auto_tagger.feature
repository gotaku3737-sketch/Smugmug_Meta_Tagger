Feature: Auto-Tagger
  As a user
  I want the app to automatically identify people in my photos
  So that I don't have to tag them manually

  Scenario: Running Auto-Tagger with trained data
    Given the database contains trained face embeddings for multiple people
    And there are scanned photos that have not been tagged
    When the user navigates to the Auto-Tagger page
    And the user clicks "Run Auto-Tagger"
    Then the app should build a FaceMatcher from the training descriptors
    And the app should run recognition against the untagged photos
    And the user should see results categorized by confidence score

  Scenario: Reviewing Matches
    Given the Auto-Tagger has finished running
    When the user views the match results
    Then matches with >=70% confidence should be marked in green
    And matches with 50-70% confidence should be marked in yellow
    And matches with <50% confidence should be marked in red
    When the user uses "✓ High Confidence"
    Then reliable matches should be auto-selected for upload
