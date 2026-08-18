import type {
  BinParetoBin,
  BinParetoHeader,
  BinParetoOptions,
  BinParetoResponse,
  DieRecord,
  WaferSummary,
} from '../../shared/contracts.js';

/*
 * Single-wafer bin pareto — a trimmed port of packages/domain/src/bin-pareto.ts.
 * Groups dies by Hard/Soft bin, filters per specifyBins, sorts per sortBy, and
 * computes bin% and cumulative% over the wafer's total dies. Pass bins are 0/1.
 */
const passBins = new Set([0, 1]);

function roundPercentage(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function deriveBinPareto(
  wafer: WaferSummary,
  dies: DieRecord[],
  options: BinParetoOptions,
): BinParetoResponse {
  if (
    options.specifyBins === 'Custom' &&
    (options.customBins.length === 0 ||
      options.customBins.some((bin) => !Number.isInteger(bin) || bin < 0))
  ) {
    throw new Error('Enter one or more bin numbers, separated by commas.');
  }

  const aggregate = new Map<number, { name: string | null; count: number }>();
  for (const die of dies) {
    const bin = options.binType === 'Hard Bin' ? die.hardBin : die.softBin;
    const name = options.binType === 'Hard Bin' ? die.hardBinName : die.softBinName;
    const current = aggregate.get(bin);
    aggregate.set(bin, { name: current?.name ?? name ?? null, count: (current?.count ?? 0) + 1 });
  }

  const custom = new Set(options.customBins);
  const included = [...aggregate.entries()].filter(([bin]) => {
    if (options.specifyBins === 'All Bins') return true;
    if (options.specifyBins === 'Failed Bins Only') return !passBins.has(bin);
    return custom.has(bin);
  });
  included.sort(([leftBin, left], [rightBin, right]) =>
    options.sortBy === 'Bin Number'
      ? leftBin - rightBin
      : right.count - left.count || leftBin - rightBin,
  );

  const totalDies = dies.length;
  let cumulativeCount = 0;
  const bins: BinParetoBin[] = included.map(([binNumber, value]) => {
    cumulativeCount += value.count;
    return {
      binNumber,
      binName: value.name ?? `Bin ${binNumber}`,
      dieCount: value.count,
      binPercentage: totalDies === 0 ? 0 : roundPercentage((value.count / totalDies) * 100),
      cumulativePercentage:
        totalDies === 0 ? 0 : roundPercentage((cumulativeCount / totalDies) * 100),
    };
  });

  const passCount = dies.filter((die) =>
    passBins.has(options.binType === 'Hard Bin' ? die.hardBin : die.softBin),
  ).length;

  const header: BinParetoHeader = {
    waferSequence: wafer.waferSequence,
    lot: wafer.lot,
    waferNumber: wafer.waferNumber,
    device: wafer.device,
    testProgram: wafer.testProgram,
    totalDies,
    passCount,
    yield: totalDies === 0 ? 0 : roundPercentage((passCount / totalDies) * 100),
  };

  return { header, bins, options: { ...options, customBins: [...options.customBins] } };
}
