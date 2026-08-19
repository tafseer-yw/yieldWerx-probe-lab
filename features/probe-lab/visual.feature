@visual
Feature: Pixel regression for the canvas charts
  The wafer map and the bin pareto chart are drawn on a canvas, so their
  correctness partly lives in pixels no DOM assertion can see: die colors,
  the pass/fail palette, bar and running-total drawing, axis text. These
  scenarios pin each chart to a committed baseline image compared with odiff.

  A visual failure is a rendering finding. Wrong numbers are caught by the
  data-layer assertions (wafer-map-data attributes, the report table) and are
  always the more severe class — pixels prove drawing, not arithmetic.

  These scenarios run only inside the pinned Playwright container
  (npm run test:visual); a host run skips them, because host-rendered pixels
  differ per GPU and font stack and must never gate anything.

  Background:
    Given the QA user is signed in
    And the sample wafer is uploaded for visual checks

  Scenario: The wafer map renders the sample wafer exactly as approved
    When the QA user opens the sample wafer
    Then the wafer map matches the approved image "wafer-map-sample.png"

  Scenario: The bin pareto chart renders the sample wafer exactly as approved
    When the QA user runs the bin pareto report for all bins of that wafer
    Then the bin pareto chart matches the approved image "bin-pareto-sample.png"
