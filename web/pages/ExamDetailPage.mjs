export function ExamDetailPage({ root, loadExam }) {
  return { name: "exam-detail", roots: [root], enter: (route) => loadExam(route.params.examId) };
}
