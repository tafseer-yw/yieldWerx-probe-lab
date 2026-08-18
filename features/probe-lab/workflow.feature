@automated @regression
Feature: yieldWerx PROBE Lab end-to-end workflows
  The lightweight app's four workflows driven through the UI and checked
  against the expected numbers for the sample wafer: 25 dies, 20 pass, 80% yield;
  one 5-die fail cluster; failed bins HB2=4 and HB3=1; no forced triage match.

  Background:
    Given the engineer is signed in

  @smoke
  Scenario: Upload a wafer CSV and see it in the wafer list
    When the engineer uploads the sample wafer CSV
    Then the wafers list shows a wafer with yield 80

  @smoke
  Scenario: The wafer map shows the die results
    When the engineer uploads the sample wafer CSV
    And the engineer opens the most recent wafer
    Then the wafer detail shows yield 80

  @smoke
  Scenario: Wafer triage combines analytics without forcing a reference match
    When the engineer uploads the sample wafer CSV
    And the engineer opens the most recent wafer
    And the engineer opens wafer triage for this wafer
    Then wafer triage reports no close match with supporting analytics

  @smoke
  Scenario: Cluster detection finds the fail-die cluster
    When the engineer uploads the sample wafer CSV
    And the engineer notes the most recent wafer sequence
    And the engineer runs cluster detection with 4-way adjacency and minimum 2 connected dies
    Then the cluster detection reports 1 cluster
    And the cluster detection reports a cluster of 5 dies

  @smoke
  Scenario: The bin pareto reports the failed bins
    When the engineer uploads the sample wafer CSV
    And the engineer notes the most recent wafer sequence
    And the engineer runs the bin pareto report for failed bins
    Then the bin pareto reports the failed bins

  @smoke
  Scenario: The PROBE guide provides role-focused interactive tracks
    When the engineer opens the PROBE guide
    Then the guide covers setup, plugins, the Dev track, and the QA track
    And sample wafers is an admin header action

  Scenario: Audited controls expose honest choices and permissions
    Then the filters, analysis options, and responsive navigation are consistent
    And a viewer cannot open the upload workflow
