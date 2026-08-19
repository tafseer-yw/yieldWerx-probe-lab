@automated @regression
Feature: yieldWerx PROBE Lab end-to-end workflows
  The lightweight app's four workflows driven through the UI and checked
  against the expected numbers for the sample wafer: 25 dies, 20 pass, 80% yield;
  one 5-die fail cluster; failed bins HB2=4 and HB3=1; no forced triage match.

  Background:
    Given the QA user is signed in

  @regression
  Scenario: Assessments reward a recorded pass and take back a recorded fail
    When the QA user opens the assessments page
    Then each track lists fifteen assessments ordered from starter to expert
    When the QA user clears any recorded result on the first QA assessment
    And the QA user records a pass on the first QA assessment with a pull request link
    Then the score goes up by ten points and the pass shows its pull request
    When the QA user records a fail on the first QA assessment
    Then the score goes back down
    When the QA user clears any recorded result on the first QA assessment

  @regression
  Scenario: Loaded sample wafers can be removed straight from the popup
    When the admin loads every sample wafer
    And the admin reopens the sample wafers popup
    Then the popup offers to remove all of them without ticking anything
    And removing them leaves no sample wafers loaded

  @smoke
  Scenario: Upload a wafer CSV and see it in the wafer list
    When the QA user uploads the sample wafer CSV
    Then the wafers list shows a wafer with yield 80

  @smoke
  Scenario: The wafer map shows the die results
    When the QA user uploads the sample wafer CSV
    And the QA user opens the most recent wafer
    Then the wafer detail shows yield 80

  @smoke
  Scenario: Wafer triage combines analytics without forcing a reference match
    When the QA user uploads the sample wafer CSV
    And the QA user opens the most recent wafer
    And the QA user opens wafer triage for this wafer
    Then wafer triage reports no close match with supporting analytics

  @smoke
  Scenario: Cluster detection finds the fail-die cluster
    When the QA user uploads the sample wafer CSV
    And the QA user notes the most recent wafer sequence
    And the QA user runs cluster detection with 4-way adjacency and minimum 2 connected dies
    Then the cluster detection reports 1 cluster
    And the cluster detection reports a cluster of 5 dies

  @smoke
  Scenario: The bin pareto reports the failed bins
    When the QA user uploads the sample wafer CSV
    And the QA user notes the most recent wafer sequence
    And the QA user runs the bin pareto report for failed bins
    Then the bin pareto reports the failed bins

  @smoke
  Scenario: The PROBE guide provides role-focused interactive tracks
    When the QA user opens the PROBE guide
    Then the guide covers setup, the database, plugins, the Dev track, and the QA track
    And sample wafers is an admin header action

  Scenario: Audited controls expose honest choices and permissions
    Then the filters, analysis options, and responsive navigation are consistent
    And a viewer cannot open the upload workflow
