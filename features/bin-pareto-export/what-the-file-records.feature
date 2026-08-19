@manual @automated @regression @feature:bin-pareto-export @cat:CAT-02
Feature: What the downloaded bin pareto file records
  A file of bare numbers cannot be trusted months later, because nobody can tell
  which question it answered. Every downloaded report therefore carries the wafer
  it came from and the options it was run with, alongside the five values the
  screen reported for each bin.

  Covers CAT-02 (AC-02, AC-04) from
  .probe/artifacts/bin-pareto-export/10-spec/spec-analysis.md.

  Background:
    Given the QA user is signed in
    And a wafer with several failing bins is loaded

  @testtype:e2e @ac:AC-02
  Scenario: Each row repeats the five values the screen reported
    Given the QA user has run a bin pareto report
    When the QA user downloads the report as a file
    Then each row carries the bin number, bin name, die count, bin share and running share
    And the values in each row match the screen for that bin

  @testtype:e2e @ac:AC-04
  Scenario: The file states the options the report was run with
    Given the QA user has run a bin pareto report with bin type "Soft Bin" and bins to show "All Bins"
    When the QA user downloads the report as a file
    Then the file records bin type "Soft Bin"
    And the file records bins to show "All Bins"
    And the file names the wafer it came from
