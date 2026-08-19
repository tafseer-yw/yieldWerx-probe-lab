@manual @automated @regression @feature:bin-pareto-export @cat:CAT-01
Feature: Downloading the bin pareto report
  An engineer who has run a bin pareto can save exactly what the screen is
  showing as a comma-separated file, instead of retyping the numbers into a
  supplier review or a weekly summary.

  Covers CAT-01 (AC-01, AC-03) from
  .probe/artifacts/bin-pareto-export/10-spec/spec-analysis.md.

  Background:
    Given the QA user is signed in
    And a wafer with several failing bins is loaded

  @smoke @testtype:e2e @ac:AC-03
  Scenario: No download is offered before a report has been run
    When the QA user opens the bin pareto screen
    Then the "Download CSV" button is not offered

  @smoke @testtype:e2e @ac:AC-01
  Scenario: Download the report that is on screen
    Given the QA user has run a bin pareto report
    When the QA user downloads the report as a file
    Then a comma-separated file is saved
    And the file holds one row for each bin shown on the screen
    And the rows are in the same order as the screen
