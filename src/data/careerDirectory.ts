// Career IDEAS students can start from. These are only a name and a field: no skills, no levels, nothing claimed about the profession.
// Picking one fills the Explorer form; the skills model is then drafted (AI or template, labelled as such) and reviewed by the student.
// Add a career = add one line here. No component changes needed. A career's field decides which mentors it sees, so reuse the same field spelling.
export const CAREER_DIRECTORY: Record<string, string[]> = {
  'Data & AI': ['Data Analyst', 'AI/ML Engineer'],
  Security: ['Cybersecurity Analyst'],
  Product: ['Product Manager'],
  Law: ['Lawyer', 'Corporate Lawyer'],
  'Public service': ['Civil Services / UPSC'],
  Healthcare: ['Doctor'],
  Education: ['Teacher'],
  Finance: ['Chartered Accountant'],
  Business: ['Entrepreneur', 'Digital Marketer'],
  Design: ['Architect', 'Fashion Designer'],
  Science: ['Researcher'],
};
