import type { Career, CareerGenerationInput } from '../types';
import { MockCareerIntelligenceProvider } from './intelligence/mockProvider';
import type { CareerIntelligenceProvider } from './intelligence/provider';

// The single place that picks a provider. To go real, return a BackendCareerIntelligenceProvider here.
const provider: CareerIntelligenceProvider = new MockCareerIntelligenceProvider();

export const careerIntelligenceService = {
  providerId: provider.id,
  validateInput(input: CareerGenerationInput): string | null {
    const name = input.name.trim();
    if (!name) return 'Enter a career or professional goal.';
    if (name.length > 80) return 'Keep the career name under 80 characters.';
    if (!/\p{L}{2}/u.test(name)) return 'Use at least two letters, for example “Corporate Lawyer”.';
    return null;
  },
  async generateCareerModel(input: CareerGenerationInput): Promise<Career> {
    const problem = careerIntelligenceService.validateInput(input);
    if (problem) throw new Error(problem);
    const career = await provider.generateCareerModel(input);
    const result = await provider.validateCareerModel(career);
    if (!result.valid) throw new Error('We could not create a usable career model for that. Try rewording it or adding a description.');
    return career;
  },
  searchCareers: (query: string) => provider.searchCareers(query),
  validateCareerModel: (career: Career) => provider.validateCareerModel(career),
};
