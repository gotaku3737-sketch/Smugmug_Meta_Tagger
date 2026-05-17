Feature: Album Sync and Thumbnail Download
  As a user
  I want to see my SmugMug albums and download thumbnails
  So that I can select which albums to scan for faces

  Scenario: Syncing Albums
    Given the user is on the Galleries page
    When the user clicks "Sync Albums"
    Then the app should fetch the list of albums from SmugMug
    And the local database should be updated with the album metadata
    And the Galleries page should display the albums

  Scenario: Downloading Thumbnails
    Given the app has synced albums
    When the user clicks "Download" on an album card
    Then the app should download small thumbnails for that album
    And the thumbnails should be saved locally
    And the album should display the thumbnails for browsing
