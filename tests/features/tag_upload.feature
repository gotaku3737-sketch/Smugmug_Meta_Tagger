Feature: Tag Upload
  As a user
  I want to upload my face tags to SmugMug
  So that my photos are searchable by face on the SmugMug platform

  Scenario: Uploading tags to SmugMug
    Given the user has selected auto-tagged photos
    When the user clicks "Upload Tags"
    Then the app should send a PATCH request for each selected photo
    And the uploaded keywords should be in the format "Person:Name"
    And existing non-person keywords on the photo should be preserved
    And a 200ms delay should be applied between requests to respect rate limits
    And the local database should mark these photos as successfully tagged
