import { Given, When, Then } from '@cucumber/cucumber';

Given('the user has an album with downloaded thumbnails', function () {
  return 'pending';
});

When('the user clicks "Scan Faces" on the album', function () {
  return 'pending';
});

Then('the app should download medium-resolution images for the album', function () {
  return 'pending';
});

Then('the app should run face detection on the images in batches', function () {
  return 'pending';
});

Then('the face bounding boxes and {int}-dimensional embeddings should be stored in the database', function (int) {
  return 'pending';
});

Then('the user should see progress updated in real time', function () {
  return 'pending';
});

Given('the app has scanned an album and detected faces', function () {
  return 'pending';
});

When('the user clicks "Train" on the scanned album', function () {
  return 'pending';
});

Then('the Face Trainer should open', function () {
  return 'pending';
});

Then('the user should see photos containing detected faces with bounding boxes', function () {
  return 'pending';
});

When('the user assigns a name to a detected face', function () {
  return 'pending';
});

Then('the face embedding should be associated with that person in the database', function () {
  return 'pending';
});

Then('the UI should reflect the new label', function () {
  return 'pending';
});
