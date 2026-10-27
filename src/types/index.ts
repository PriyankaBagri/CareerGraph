export type ID = string;
export interface User { id: ID; name: string; email: string; initials: string }
export type ExperienceLevel = 'beginner' | 'early' | 'intermediate' | 'experienced';
export interface SkillAssessment { skillId: ID; currentLevel: number }
export interface Profile { userId: ID; stage: string; education: string; experienceSummary: string; targetCareerId: ID; experienceLevel: ExperienceLevel; isDemo?: boolean; onboardingComplete: boolean; skillAssessments: SkillAssessment[]; completeness: number; lastAnalysis: string; createdAt: string; updatedAt: string }
export interface OnboardingInput { targetCareerId: ID; experienceLevel: ExperienceLevel; headline?: string; skillAssessments: SkillAssessment[] }
export interface OnboardingState { headline: string; targetCareerId: ID | null; experienceLevel: ExperienceLevel | null; assessments: Record<ID, number> }
export interface Skill { id: ID; name: string; description?: string; currentLevel: number; requiredLevel: number; evidenceIds: ID[] }
export interface Capability { id: ID; name: string; description?: string; skills: Skill[] }
export type CareerSource = 'seed' | 'custom' | 'ai';
export interface CareerOrigin { source: CareerSource; createdAt?: string; generatedFrom?: string }
export interface Career { id: ID; name: string; category: string; description: string; capabilities: Capability[]; origin?: CareerOrigin; evidenceExpectations?: string[] }
export interface CareerGenerationInput { name: string; field?: string; description?: string }
export interface CareerValidationResult { valid: boolean; errors: string[] }
export interface CareerRequirement { skillId: ID; capabilityId: ID; requiredLevel: number; weight: number }
export type EvidenceType = 'Project' | 'Internship' | 'Work Experience' | 'Certification' | 'Course' | 'Publication' | 'Research' | 'Assessment' | 'Competition' | 'Achievement' | 'Volunteer Work' | 'Portfolio' | 'Case Study' | 'Other';
export type EvidenceStrength = 'weak' | 'moderate' | 'strong' | 'very_strong';
export interface Evidence { id: ID; userId?: ID; title: string; description: string; type: EvidenceType; url?: string; date?: string; organization?: string; skillIds: ID[]; strength: EvidenceStrength; source: 'user' | 'example'; provenance?: EvidenceProvenance; createdAt: string; updatedAt: string }
// Where evidence came from and whether anyone independently checked it. 'verified' only ever arrives from the server with a complete verification record.
export interface EvidenceProvenance { origin: 'user_provided' | 'system_derived'; verification: 'unverified' | 'verified'; label: string }
export type EvidenceInput = Omit<Evidence, 'id' | 'userId' | 'source' | 'createdAt' | 'updatedAt'>;
export interface CareerDataset { career: Career; evidence: Evidence[] }
export interface CareerSummary { id: ID; name: string; category: string; description: string; source: CareerSource }
export interface ReadinessMetric { key: string; label: string; value: number }
export interface ReadinessReason { tone: 'strong' | 'developing' | 'missing'; text: string }
export interface ReadinessAssessment { state: 'not_assessed' | 'partial' | 'assessed'; assessed: number; total: number }
// `backend` is set only when the numbers came from the server's rule-based engine: it carries the honest coverage and caveats.
// The career's evaluation rules exactly as the server applied them (default or the career's own).
export interface EvaluationRulesView { levelWeight: number; evidenceFullFactor: number; evidenceThinBelow: number; strengthPoints?: Record<string, number> }
export interface ReadinessBackend { score: number | null; range: { min: number; max: number } | null; caveats: string[]; assessedWeightShare: number; evaluation?: { source: 'default' | 'custom'; description: string; rules?: EvaluationRulesView }; formula?: string }
export interface Readiness { overall: number; assessment: ReadinessAssessment; summary: string; metrics: ReadinessMetric[]; reasons: ReadinessReason[]; backend?: ReadinessBackend }
export interface Gap { skillId: ID; skillName: string; capabilityName: string; requiredLevel: number; currentLevel: number; size: number; impact: 'high' | 'medium'; evidenceCount: number; kind: 'skill' | 'evidence' | 'combined' }
export type ActionType = 'build_skill' | 'strengthen_skill' | 'create_evidence' | 'gain_experience' | 'complete_learning' | 'practice' | 'research' | 'portfolio' | 'certification' | 'networking' | 'application_prep' | 'other';
export type ActionStatus = 'not_started' | 'in_progress' | 'completed';
export type RoadmapPhase = 'foundation' | 'skill_building' | 'evidence_building' | 'career_readiness';
export type Level3 = 'high' | 'medium' | 'low';
// Derived from career + skills + evidence (never typed in by hand). createdAt/updatedAt are '' until the user acts on it.
export type GuidanceKind = 'foundation' | 'practice' | 'portfolio' | 'assess' | 'evidence';
/** Server-derived, student-facing guidance for one action. Estimates are labelled; resources are search hints, never invented links. */
export interface ActionGuidance { kind: GuidanceKind; kindLabel: string; title: string; whyItMatters: string; whyNow: string; outcome: string; steps: string[]; prerequisites: string[]; effort: { text: string; isEstimate: true; basis: string }; resources: { note: string; searchTerms: string[] }; definitionOfDone: string[]; evidenceToSubmit: string; ratingNote: string; basis: string }
export interface ActionDetail { guidance?: ActionGuidance; kind: 'build_skill' | 'assess_skill' | 'add_evidence'; skillName: string; recommendation: string; completionCriterion: string; currentLevel: number | null; targetLevel: number; rank: number }
export interface Action { id: ID; careerId: ID; title: string; description: string; type: ActionType; relatedSkillIds: ID[]; relatedCapabilityIds: ID[]; reason: string; priority: Level3; priorityScore: number; impact: Level3; effort?: Level3; status: ActionStatus; estimatedTime?: string; prerequisites: ID[]; phase: RoadmapPhase; createdAt: string; updatedAt: string; /** structured server detail; absent for local/demo actions */ detail?: ActionDetail }
export interface RoadmapItem { id: ID; actionId: ID; title: string; description: string; phase: RoadmapPhase; order: number; status: ActionStatus; relatedSkillIds: ID[]; estimatedTime?: string }
export interface RoadmapMilestone { phase: RoadmapPhase; title: string; total: number; completed: number; progress: number }
export interface Roadmap { careerId: ID; items: RoadmapItem[]; milestones: RoadmapMilestone[]; progress: number; updatedAt: string }
export interface ProgressSnapshot { date: string; overall: number }
export interface DashboardView { career: Career; evidence: Evidence[]; readiness: Readiness; gaps: Gap[]; actions: Action[]; skills: SkillAnalysis[]; evidenceIsExample: boolean; /** from the server: how actions are ranked, and the evidence this career expects */ guidance?: { priorityCriteria: string; evidenceExpectations: string[] } }
export type SkillStatus = 'on_track' | 'skill_gap' | 'evidence_gap' | 'combined_gap' | 'not_assessed';
export type CoverageLevel = 'none' | 'weak' | 'moderate' | 'strong';
// The server's own per-skill numbers (only present in backend mode). The UI explains these; it never recomputes a different score.
export interface SkillBreakdownView { importance: number; levelRatio: number | null; evidencePoints: number; evidenceRatio: number; evidenceRequired: number | null; evidenceStatus: 'none' | 'thin' | 'sufficient'; skillScore: number | null; weightShare: number | null; contribution: number | null }
export interface SkillAnalysis { assessed: boolean; skillId: ID; name: string; capabilityId: ID; capabilityName: string; careerName: string; requiredLevel: number; currentLevel: number; skillGap: number; evidence: Evidence[]; evidenceCount: number; strongest: EvidenceStrength | null; coverage: CoverageLevel; status: SkillStatus; nextAction: string; breakdown?: SkillBreakdownView }
export interface AssistantReference { kind: 'readiness' | 'skill' | 'action' | 'evidence' | 'roadmap' | 'profile'; label: string; href?: string }
export interface AssistantItem { kind: AssistantReference['kind']; title: string; detail?: string; href?: string }
export interface AssistantAnswer { text: string; references: AssistantReference[]; items?: AssistantItem[] }
export interface AssistantMessage { id: string; role: 'user' | 'assistant'; text: string; references?: AssistantReference[]; items?: AssistantItem[]; error?: boolean;
  /** present only on replies generated by a server-side AI model; absent on rule-based answers */ ai?: { label: string; model: string; notice: string; basedOn: string | null } }
// A read-only snapshot of existing CareerGraph data. The assistant never sees or changes anything else.
export interface AssistantContext { careerId: ID; careerName: string; careerDescription: string; readiness: Readiness; skills: SkillAnalysis[]; gaps: Gap[]; actions: Action[]; roadmapProgress: number; evidence: Evidence[]; profile: { stage: string; education: string; note: string } }
export interface UserSettings { reduceMotion: boolean; assistantSuggestions: boolean }
