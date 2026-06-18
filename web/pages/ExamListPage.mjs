export function ExamListPage({ root, loadExams }) {
  return { name: "exams", roots: [root], enter: () => loadExams() };
}
