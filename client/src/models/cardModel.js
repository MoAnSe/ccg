export function createCardModel(data = {}) {
  return {
    id: data.id || "",
    name: data.name || "",
    atk: data.atk || 0,
    hp: data.hp || 0
  };
}
