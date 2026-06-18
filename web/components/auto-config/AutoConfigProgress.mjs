export function AutoConfigProgress(documentObject = document) {
  return { name: "AutoConfigProgress", element: documentObject.querySelector("#progressNumber")?.closest(".panel") };
}
