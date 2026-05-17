Feature: Authentication
  As a user
  I want to connect my SmugMug account
  So that the application can access and tag my photos

  Scenario: Successful first-time connection
    Given the user has not connected to SmugMug before
    When the user navigates to the Connect page
    And the user enters their API Key and API Secret
    And the user clicks "Connect to SmugMug"
    Then the user should be prompted to authorize the app in their browser
    When the user enters the 6-digit verifier code
    And the user clicks "Complete Authorization"
    Then the app should securely store the credentials
    And the user should be redirected to the Galleries page

  Scenario: Existing connection
    Given the user has previously connected to SmugMug
    And the credentials are valid
    When the app launches
    Then the user should be automatically logged in
    And the user should see the Galleries page
