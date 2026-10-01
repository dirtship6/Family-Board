import { playOrder, useStore } from "../store";

export function ReadingPicker({ selected, onChange }: { selected: string[]; onChange(ids: string[]): void }) {
  const { readings } = useStore();
  const ordered = playOrder(readings);
  const courses = [...new Set(ordered.map((r) => r.course))];
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  if (!readings.length) return <p className="muted">Your library is empty.</p>;
  return (
    <div className="picker">
      {courses.map((c) => {
        const ids = ordered.filter((r) => r.course === c).map((r) => r.id);
        const allOn = ids.every((id) => selected.includes(id));
        return (
          <fieldset key={c}>
            <legend>
              <label>
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={() => onChange(allOn ? selected.filter((x) => !ids.includes(x)) : [...new Set([...selected, ...ids])])}
                />{" "}
                {c}
              </label>
            </legend>
            {ordered
              .filter((r) => r.course === c)
              .map((r) => (
                <label key={r.id} className="pick">
                  <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} /> {r.title}
                </label>
              ))}
          </fieldset>
        );
      })}
    </div>
  );
}
