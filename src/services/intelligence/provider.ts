import type { Career, CareerGenerationInput, CareerValidationResult } from '../../types';

// Contract for anything that can produce a career model. The UI only knows this interface.
// Implementations: MockCareerIntelligenceProvider (local, below). Future: BackendCareerIntelligenceProvider
// calling a server that holds the AI key. Never call an AI vendor directly from the browser.
export interface CareerIntelligenceProvider {
  readonly id: string;
  generateCareerModel(input: CareerGenerationInput): Promise<Career>;
  searchCareers(query: string): Promise<Career[]>;
  validateCareerModel(career: Career): Promise<CareerValidationResult>;
}
