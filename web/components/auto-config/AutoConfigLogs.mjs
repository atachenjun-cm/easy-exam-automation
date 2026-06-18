export function AutoConfigLogs(documentObject = document) {
  return { name: "AutoConfigLogs", element: documentObject.querySelector("#logList")?.closest(".panel") };
}
