/*
 * Field help, in one place so the wording can be reviewed as a set.
 *
 * Every entry answers the same three questions in plain language:
 *   what — what this control is, in one sentence
 *   why  — why it exists / what it changes about the result
 *   how  — what to actually do, including the gotcha
 *
 * Keep sentences short and concrete. No jargon that is not defined on screen.
 */

export interface FieldHelp {
  what: string;
  why: string;
  how: string;
}

export interface AnalysisHelp {
  what: string;
  how: string;
  algorithm?: {
    title: string;
    summary: string;
    steps: readonly string[];
  };
  roi: string;
}

export const analysisHelp = {
  waferTriage: {
    what: 'This page helps you decide what to check first on one wafer. It shows where dies failed, which failures touch each other, and which failure bin is biggest. It does not guess the real cause or change any data.',
    how: 'Choose a wafer and run triage. The app compares its shape with three practice examples. It checks the center, middle, and edge. It also finds groups of touching failures and counts the failed bins. It then gives you a simple order for reviewing the results.',
    algorithm: {
      title: 'Pattern-matching algorithm',
      summary:
        'This is a fixed pattern-matching algorithm. It follows the same rules every time. It does not train itself, learn from user data, or change its own rules. Here is exactly what it does:',
      steps: [
        'It reads each die’s X and Y location, pass or fail result, and hard bin. It scales the map to one standard size so wafers with different map sizes can be compared.',
        'It turns the wafer into 15 measurements. These include the total fail rate; fail rates in the center, middle, edge, and four quarters of the map; the average failure location; how much the failures look like a line; cluster size and count; and the share in the biggest failed bin.',
        'It makes the same 15 measurements for three fixed example wafers: Healthy baseline, Handling scratch, and Edge ring.',
        'For each example, it checks the gap between every measurement. Center, middle, and edge each get 1.3 importance points. Line shape gets 1.1. Cluster clues get 0.5 to 1.0. Overall fail rate gets 0.7. Map quarter clues get 0.5. Average failure location and biggest failed bin get 0.25 to 0.3. These values are fixed in the code and never learned from user data.',
        'It squares each gap so negative and positive gaps are treated the same. It multiplies each squared gap by its importance, adds them, divides by all the importance points, and takes the square root. It subtracts that distance from 1 and shows the answer as 0% to 100%. A smaller distance gives a higher match score.',
        'If fewer than three dies fail, it says Insufficient data. Otherwise, the highest score wins only when it is at least 62%. A lower score gives No close match. The result is a shape label, not a cause, diagnosis, or confidence level.',
      ],
    },
    roi: 'You spend less time opening different pages and deciding where to start. Engineers can look at the biggest problem first. QA can check that the map, groups, and counts tell the same story. Everything runs inside this app and follows the same rules on every run.',
  },
  clusterDetection: {
    what: 'This page finds failing dies that sit next to each other. A group may look like a scratch, a spot, or another local problem. The page shows each group on the wafer map and lists its die locations.',
    how: 'Choose a wafer, how neighbours should touch, and the smallest group you care about. With 4-way, dies touch on a side. With 8-way, corner-to-corner also counts. The app joins the touching failures, hides groups that are too small, and shows the biggest groups first.',
    algorithm: {
      title: 'Cluster detection algorithm',
      summary:
        'This uses a fixed connected-group search, also called breadth-first search. It follows the same rules every time and does not change any wafer data. Here is exactly what it does:',
      steps: [
        'It keeps only failing dies. Passing dies are ignored and cannot join two groups together.',
        'It starts at one failing die that has not been checked yet and places it in a new group.',
        'It looks beside that die. With 4-way, it checks up, down, left, and right. With 8-way, it also checks the four diagonal corners.',
        'Every touching failing die is added to the group and checked in the same way. This continues until no new failing neighbour is found. A chain of touching failures therefore stays in one group, even when its two ends do not touch each other.',
        'It repeats the search from the next unchecked failing die. A gap, a passing die, or a missing map location keeps groups separate. The wafer edges do not join or wrap around.',
        'It removes groups smaller than the chosen minimum. It then shows the remaining groups from largest to smallest and numbers them 1, 2, 3, and so on. Equal-sized groups are ordered from top to bottom, then left to right.',
      ],
    },
    roi: 'You can spot a local problem much faster than by reading a long list of die locations. Engineers know which group to inspect first. QA can use the exact locations to repeat the same check. The run is safe because it does not save changes or re-bin dies.',
  },
  binPareto: {
    what: 'This report shows which bins contain the most dies on one wafer. The biggest bin appears first. It also shows how much of the wafer each bin uses and a running total across the bins.',
    how: 'Choose a wafer and the kind of bins you want to see. You can show all bins, failed bins, or only bins you name. The app counts the dies in each bin, works out each share of the whole wafer, and draws the same numbers in a chart and a table.',
    roi: 'You can focus on the few bins causing most of the loss instead of treating every bin as equally important. Engineers get a clear starting point. QA can quickly compare the chart with the table and the raw die counts. The report is rebuilt each time, so it does not show an old saved result.',
  },
} as const satisfies Record<string, AnalysisHelp>;

export const help = {
  device: {
    what: 'The product that was tested — for example PROBE-DEV-1.',
    why: 'Every wafer is filed under a device, and the device decides which test programs you may choose.',
    how: 'Pick the device this file came from. The device and test program must be a real pair, or the upload is refused.',
  },
  testProgram: {
    what: 'The test recipe the tester ran on this wafer.',
    why: 'One device can be tested by different programs, so the wafer is stored against the program that produced it.',
    how: 'Choose a device first — this list then shows only that device’s programs. In this app each device has exactly one.',
  },
  pasteCsv: {
    what: 'The contents of a wafer CSV, typed or pasted straight in.',
    why: 'Handy for trying a few rows without saving a file first. It lands exactly like an uploaded file.',
    how: 'Paste the header line and the data rows, up to 5 MB. Same columns and same rules as a file.',
  },
  csvFile: {
    what: 'The wafer result file, as CSV or ATDF.',
    why: 'This is the data that becomes a lot, a wafer, its dies and its yield. Rows that fail a check never land.',
    how: 'Drop a .csv or .atdf file here, or click to browse. A CSV needs the columns Lot, Wafer, X, Y, HB#, SB#, PF_Flag, where hard bin 0 or 1 means pass. An ATDF is read from its own MIR, WIR, HBR, SBR and PRR records, so it needs no columns.',
  },
  historyStatus: {
    what: 'Shows only uploads that ended in the status you pick.',
    why: 'The quickest way to find trouble — for example every file that was Rejected.',
    how: 'Pick a finished status, or All statuses to clear the filter.',
  },
  historySearch: {
    what: 'Free-text search across the file name and the lot code.',
    why: 'Faster than paging when you remember part of a name.',
    how: 'Type any part of a file name or lot. It matches anywhere in the text, not just the start.',
  },
  filterLot: {
    what: 'Narrows the list to lots whose code contains what you type.',
    why: 'A device can hold many lots, and you usually care about one.',
    how: 'Type any part of the lot code. Leave it empty to see every lot.',
  },
  filterDevice: {
    what: 'Narrows the list to devices whose code contains what you type.',
    why: 'Useful once more than one device has wafers loaded.',
    how: 'Type any part of a device code, such as DEV-1.',
  },
  filterProgram: {
    what: 'Narrows the list to test programs whose code contains what you type.',
    why: 'Separates wafers tested by different recipes on the same device.',
    how: 'Type any part of a program code, such as PGM-1.',
  },
  waferSequence: {
    what: 'The database number of one saved wafer — not the wafer number printed on the wafer.',
    why: 'The API uses it as a compact internal key. People can identify a wafer by device, lot and wafer number instead.',
    how: 'Use the wafer picker in Wafer triage, or open a wafer and use Detect clusters or Bin pareto to fill it in for you.',
  },
  adjacency: {
    what: 'Decides which neighbouring dies count as touching.',
    why: 'It changes how many clusters you find. Two failing dies that meet only at a corner are one cluster with 8-way, but two separate ones with 4-way.',
    how: '4-way counts up, down, left and right. 8-way also counts the four diagonals. Try both on the same wafer and compare.',
  },
  minimumConnectedDies: {
    what: 'The smallest group of touching failing dies that is allowed to count as a cluster.',
    why: 'It filters out noise. One failing die on its own is usually a random failure, not a scratch or a particle.',
    how: 'Start at 2. Raise it to keep only the big clusters. Setting it to 1 makes every single failing die a cluster.',
  },
  binType: {
    what: 'Which bin number the dies are grouped by.',
    why: 'The hard bin is the coarse result — pass or which failure family. The soft bin is the detailed reason.',
    how: 'Start with Hard bin to see where the loss is, then switch to Soft bin to see exactly which test failed. Pass count and yield follow whichever you pick.',
  },
  specifyBins: {
    what: 'Which bins are included in the chart and the table.',
    why: 'Passing bins are usually most of the wafer, and they flatten the very chart you are using to find loss.',
    how: 'Failed bins only hides bins 0 and 1. All bins shows everything and ends at 100%. Custom shows only the bins you list.',
  },
  sortBy: {
    what: 'The order of the bars and the table rows.',
    why: 'A pareto is meant to be biggest-first, so the bin costing you the most yield is first.',
    how: 'Bin Occurrence puts the most dies first. Bin Number puts them in numeric order. Equal counts always fall back to the lower bin number.',
  },
  customBins: {
    what: 'The exact bins you want to see, and nothing else.',
    why: 'Useful when you are chasing one or two known failures and want the rest out of the way.',
    how: 'Type bin numbers separated by commas, such as 2,3. Whole numbers only — anything else is refused with a message.',
  },
  colourDiesBy: {
    what: 'What the colours on the wafer map mean. Pass / fail is a two-colour view; Hard bin and Soft bin give every bin its own shade.',
    why: 'Pass / fail answers "how much am I losing". A bin view answers "what is it failing for". Hard bin is the tester’s own verdict and never changes; Soft bin is the refined one that later analysis can rewrite, so the two can disagree on the same die.',
    how: 'Start on Pass / fail for yield at a glance, then switch to a bin view to see the failure mix — the darkest red is the most common failing bin, and the legend lists every bin with its die count.',
  },
  waferMap: {
    what: 'The wafer drawn as it is laid out: one square per die site, in its real X and Y position.',
    why: 'Where failures sit matters as much as how many there are. A tight group points at a physical cause; scattered failures usually do not.',
    how: 'Hover a die to read its coordinate and bins. Pale squares are die sites with no measured result.',
  },
  signatureMatch: {
    what: 'The pattern-comparison signal within Wafer triage, using three deterministic practice references.',
    why: 'It complements the spatial profile, clusters, and failed bins so similar failure shapes are easier to recognize.',
    how: 'Run triage for a wafer sequence. Treat the percentage as a match score, not confidence or a root-cause diagnosis. A low score correctly returns No close match.',
  },
  detectedClusters: {
    what: 'Every group of touching failing dies that met your minimum size, largest first.',
    why: 'The biggest cluster is normally the one worth investigating.',
    how: 'Select a row to highlight only that cluster on the map and list its coordinates. Select it again to show them all.',
  },
  binLoss: {
    what: 'The bins on this wafer, ranked, with a running total percentage.',
    why: 'It shows how few bins account for most of the loss, so you know what to fix first.',
    how: 'Read the bars for each bin’s share, and the line for the running total. Every value is repeated in the table below.',
  },
} as const satisfies Record<string, FieldHelp>;
