import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { VariablesEditorProps } from "@/types"

/** The variables editor — name / type / description rows with add + remove. */
export function VariablesEditor({
  variables,
  onChange,
  disabled,
}: VariablesEditorProps) {
  function update(
    index: number,
    patch: Partial<VariablesEditorProps["variables"][number]>
  ) {
    onChange(variables.map((v, i) => (i === index ? { ...v, ...patch } : v)))
  }
  function remove(index: number) {
    onChange(variables.filter((_, i) => i !== index))
  }
  function add() {
    onChange([...variables, { name: "", type: "string", description: "" }])
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label>Variables</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={add}
        >
          Add variable
        </Button>
      </div>
      {variables.length === 0 ? (
        <p className="text-xs text-ink3">No variables documented.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {variables.map((variable, index) => (
            <li key={index} className="flex items-end gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <Label
                  htmlFor={`var-name-${index}`}
                  className="text-[11px] font-bold tracking-wider text-ink3 uppercase"
                >
                  Name
                </Label>
                <Input
                  id={`var-name-${index}`}
                  value={variable.name}
                  disabled={disabled}
                  onChange={(e) => update(index, { name: e.target.value })}
                />
              </div>
              <div className="flex w-28 flex-col gap-1">
                <Label
                  htmlFor={`var-type-${index}`}
                  className="text-[11px] font-bold tracking-wider text-ink3 uppercase"
                >
                  Type
                </Label>
                <Input
                  id={`var-type-${index}`}
                  value={variable.type}
                  disabled={disabled}
                  onChange={(e) => update(index, { type: e.target.value })}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <Label
                  htmlFor={`var-desc-${index}`}
                  className="text-[11px] font-bold tracking-wider text-ink3 uppercase"
                >
                  Description
                </Label>
                <Input
                  id={`var-desc-${index}`}
                  value={variable.description}
                  disabled={disabled}
                  onChange={(e) =>
                    update(index, { description: e.target.value })
                  }
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={disabled}
                aria-label={`Remove variable ${index + 1}`}
                onClick={() => remove(index)}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
