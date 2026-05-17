import { Given, When, Then } from '@cucumber/cucumber';

Given('the database contains trained face embeddings for multiple people', function () {
  return 'pending';
});

Given('there are scanned photos that have not been tagged', function () {
  return 'pending';
});

When('the user navigates to the Auto-Tagger page', function () {
  return 'pending';
});

When('the user clicks "Run Auto-Tagger"', function () {
  return 'pending';
});

Then('the app should build a FaceMatcher from the training descriptors', function () {
  return 'pending';
});

Then('the app should run recognition against the untagged photos', function () {
  return 'pending';
});

Then('the user should see results categorized by confidence score', function () {
  return 'pending';
});

Given('the Auto-Tagger has finished running', function () {
  return 'pending';
});

When('the user views the match results', function () {
  return 'pending';
});

Then('matches with >={int}% confidence should be marked in green', function (int) {
  return 'pending';
});

Then('matches with {int}-{int}% confidence should be marked in yellow', function (int, int2) {
  return 'pending';
});

Then('matches with <{int}% confidence should be marked in red', function (int) {
  return 'pending';
});

When('the user uses "✓ High Confidence"', function () {
  return 'pending';
});

Then('reliable matches should be auto-selected for upload', function () {
  return 'pending';
});

Given('the user has selected auto-tagged photos', function () {
  return 'pending';
});

When('the user clicks "Upload Tags"', function () {
  return 'pending';
});

Then('the app should send a PATCH request for each selected photo', function () {
  return 'pending';
});

Then('the uploaded keywords should be in the format "Person:Name"', function () {
  return 'pending';
});

Then('existing non-person keywords on the photo should be preserved', function () {
  return 'pending';
});

Then('a {int}ms delay should be applied between requests to respect rate limits', function (int) {
  return 'pending';
});

Then('the local database should mark these photos as successfully tagged', function () {
  return 'pending';
});
