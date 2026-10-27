// The only place the server reaches into the frontend codebase: the seeded career data (pure data, no React/DOM).
// Later phases reuse the frontend's pure readiness/action engines from here too, so there is never a second copy.
export type { Career, CareerDataset } from '../../../src/types';
export { CAREER_DATASETS } from '../../../src/data/careers';
