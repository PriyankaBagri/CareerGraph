export interface CareerSummaryRecord { id: string; name: string; category: string; description: string; source: string }
export interface CapabilityRecord { id: string; careerId: string; name: string; description: string; position: number }
export interface SkillRecord { id: string; name: string; description: string; category: string | null }
export interface RequirementRecord { careerId: string; skillId: string; capabilityId: string; requiredLevel: number; importance: number; position: number; /** fewest evidence items this career asks for on the skill (null = no minimum) */ minEvidence?: number | null }
export interface CareerModelRecord { career: CareerSummaryRecord & { evidenceExpectations: string[]; /** stored per-career overrides of the evaluation rules; null = built-in defaults */ evaluationRules?: unknown }; capabilities: CapabilityRecord[]; skills: SkillRecord[]; requirements: RequirementRecord[] }
export interface AssessmentRecord { skillId: string; level: number; source: string; assessedAt: string; updatedAt: string }
export interface EvidenceRecord { id: string; title: string; description: string; type: string; url: string | null; date: string | null; organization: string | null; strength: string; source: string; skillIds: string[]; createdAt: string; updatedAt: string }
export interface EvidenceInput { title: string; description: string; type: string; url: string | null; date: string | null; organization: string | null; strength: string; skillIds: string[] }
export type EvidencePatch = Partial<EvidenceInput>;

// A user-defined career. Ids are server-generated; on update, an existing capability/skill id (it must start with "<careerId>:") is kept
// so the user's ratings and evidence links survive edits. Skills/capabilities left out of an update are removed.
export interface CustomSkillInput { id?: string; name: string; requiredLevel: number; importance: number; minEvidence?: number | null; /** optional plain-language description, stored in the existing skills.description column */ description?: string }
export interface CustomCapabilityInput { id?: string; name: string; description: string; skills: CustomSkillInput[] }
export interface CustomCareerInput { name: string; category: string; description: string; evidenceExpectations: string[]; capabilities: CustomCapabilityInput[]; /** validated override of the evaluation rules (null/absent = defaults) */ evaluationRules?: Record<string, unknown> | null }

// Every user-owned method takes the authenticated userId first and scopes its query by it. There is no method that reads or writes
// another user's rows. "Visible" careers = shared (seeded) careers + the user's own custom careers.
export interface CoreRepos {
  listCareers(userId: string): Promise<CareerSummaryRecord[]>;
  getCareerModel(userId: string, careerId: string): Promise<CareerModelRecord | null>;
  createCustomCareer(userId: string, careerId: string, input: CustomCareerInput): Promise<void>;
  /** false when the career is not a custom career owned by userId (seeded, someone else's, or missing). */
  updateCustomCareer(userId: string, careerId: string, input: CustomCareerInput): Promise<boolean>;
  deleteCustomCareer(userId: string, careerId: string): Promise<boolean>;
  visibleSkillIds(userId: string, skillIds: string[]): Promise<string[]>;
  listAssessments(userId: string): Promise<AssessmentRecord[]>;
  getAssessment(userId: string, skillId: string): Promise<AssessmentRecord | null>;
  upsertAssessment(userId: string, skillId: string, level: number, source: string): Promise<AssessmentRecord>;
  deleteAssessment(userId: string, skillId: string): Promise<boolean>;
  listEvidence(userId: string): Promise<EvidenceRecord[]>;
  getEvidence(userId: string, id: string): Promise<EvidenceRecord | null>;
  createEvidence(userId: string, input: EvidenceInput): Promise<EvidenceRecord>;
  updateEvidence(userId: string, id: string, patch: EvidencePatch): Promise<EvidenceRecord | null>;
  deleteEvidence(userId: string, id: string): Promise<boolean>;
  /** true when the link was newly created, false when it already existed. The evidence must belong to userId (checked by the service). */
  linkEvidenceSkill(userId: string, evidenceId: string, skillId: string): Promise<boolean>;
  unlinkEvidenceSkill(userId: string, evidenceId: string, skillId: string): Promise<boolean>;
}
