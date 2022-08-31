/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/**
 * Bucket Statistic: count value per specified buckets.
 * Used to show histogram
 */

// Bucket Statistic: count value per specified buckets.
// buckets: array of upper bounds for buckets: [0.1,0.2,0.5,1,10,20,50]
export class SwsBucketStats {
  private count = 0;

  private buckets = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

  private values = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

  constructor(buckets?: number[]) {
    if (buckets) {
      this.buckets = Array.from(buckets);
      this.values = new Array(this.buckets.length);
      this.values.fill(0);
      this.values.push(0);
    }
  }

  public async countValue(value: number): Promise<void> {
    this.count += 1;
    let valuePlaced = false;
    for (let i = 0; i < this.buckets.length; i += 1) {
      if (!valuePlaced && value <= this.buckets[i]) {
        this.values[i] += 1;
        valuePlaced = true;
      }
    }
    // Place value to last bucket ( <= Infinity ) if it's not placed in other bucket
    if (!valuePlaced) this.values[this.values.length - 1] += 1;
  }
}
