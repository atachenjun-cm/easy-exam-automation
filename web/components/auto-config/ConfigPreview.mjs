export function ConfigPreview(documentObject = document) {
  return { name: "ConfigPreview", element: documentObject.querySelector("#previewRows")?.closest(".panel") };
}
