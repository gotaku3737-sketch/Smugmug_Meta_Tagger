Feature: Face Training
  As a user
  I want to label detected faces with names
  So that the face recognition model can learn to identify those people

  Scenario: Labeling a Face
    Given the app has scanned an album and detected faces
    When the user clicks "Train" on the scanned album
    Then the Face Trainer should open
    And the user should see photos containing detected faces with bounding boxes
    When the user assigns a name to a detected face
    Then the face embedding should be associated with that person in the database
    And the UI should reflect the new label
