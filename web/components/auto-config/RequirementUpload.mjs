export function RequirementUpload(documentObject = document) {
  return { name: "RequirementUpload", element: documentObject.querySelector("#dropZone")?.closest(".panel") };
}
