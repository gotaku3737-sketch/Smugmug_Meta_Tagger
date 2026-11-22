import { Given, When, Then, Before } from '@cucumber/cucumber';
import assert from 'node:assert/strict';

let keywordFormatMode: 'prefixed' | 'plain' = 'prefixed';
let keywordPrefix = 'Person:';
let existingKeywordsInput = '';
let formattedKeywordsResult = '';

Before({ tags: '@keyword-format' }, function () {
  keywordFormatMode = 'prefixed';
  keywordPrefix = 'Person:';
  existingKeywordsInput = '';
  formattedKeywordsResult = '';
});

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

// -----------------------------------------------------------
// Configurable Keyword Format Scenarios
// -----------------------------------------------------------

Given('the keyword format setting is {string}', function (mode: string) {
  keywordFormatMode = mode === 'plain' ? 'plain' : 'prefixed';
  keywordPrefix = keywordFormatMode === 'plain' ? '' : 'Person:';
});

Given('the keyword format setting is {string} with prefix {string}', function (mode: string, prefix: string) {
  keywordFormatMode = mode === 'plain' ? 'plain' : 'prefixed';
  keywordPrefix = prefix;
});

Given('a photo has existing keywords {string}', function (keywords: string) {
  existingKeywordsInput = keywords;
});

When('person tags {string} and {string} are formatted for upload', function (person1: string, person2: string) {
  const existing = existingKeywordsInput
    ? existingKeywordsInput.split(';').map(k => k.trim()).filter(Boolean)
    : [];

  const personNames = [person1, person2];
  const nonPersonTags = keywordFormatMode === 'prefixed' && keywordPrefix
    ? existing.filter(k => !k.startsWith(keywordPrefix))
    : existing.filter(k => !personNames.includes(k));

  const newPersonTags = keywordFormatMode === 'prefixed' && keywordPrefix
    ? personNames.map(name => `${keywordPrefix}${name}`)
    : personNames;

  formattedKeywordsResult = [...nonPersonTags, ...newPersonTags].join('; ');
});

Then('the resulting SmugMug keywords string should be {string}', function (expected: string) {
  assert.equal(formattedKeywordsResult, expected);
});
