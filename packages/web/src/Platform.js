export const reloadApp = (url) => {
  if (typeof document === "undefined") {
    return;
  }
  location.replace(url ?? "/");
};
