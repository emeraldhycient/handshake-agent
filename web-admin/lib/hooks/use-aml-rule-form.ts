"use client"

import { useState } from "react"
import type { AmlRule } from "@handshake-agent/contracts"

import {
  useAdminMe,
  useCreateAmlRule,
  useUpdateAmlRule,
} from "@/lib/query/hooks"
import { useStepUpRetry } from "@/lib/hooks/use-step-up-retry"
import { toErrorMessage } from "@/lib/error-message"
import {
  buildCreateBody,
  buildUpdateBody,
  parseParameters,
} from "@/lib/compliance/aml-rule"
import { ACTIONS, RULE_TYPES } from "@/constants/aml-rule"

/**
 * The AML engine-rule create/edit form state machine. Mounted only while the dialog is
 * open, so the `useState` initializers seed from `rule` without a state-syncing effect.
 * On save the `parameters` JSON is parsed (invalid → inline error), then the body is
 * validated and run through the step-up gate (a 403 opens the StepUpDialog and replays
 * after re-auth). On edit `ruleKey` + `ruleType` are immutable. Nothing moves money
 * (§3.1). Extracted so the form is presentation.
 */
export function useAmlRuleForm(rule: AmlRule | null, onClose: () => void) {
  const isEdit = rule !== null
  const me = useAdminMe()
  const create = useCreateAmlRule()
  const update = useUpdateAmlRule()
  const stepUp = useStepUpRetry()

  const [ruleKey, setRuleKey] = useState(rule?.ruleKey ?? "")
  const [name, setName] = useState(rule?.name ?? "")
  const [description, setDescription] = useState(rule?.description ?? "")
  const [ruleType, setRuleType] = useState<AmlRule["ruleType"]>(
    rule?.ruleType ?? RULE_TYPES[0]
  )
  const [action, setAction] = useState<AmlRule["action"]>(
    rule?.action ?? ACTIONS[0]
  )
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  const [parameters, setParameters] = useState(
    rule ? JSON.stringify(rule.parameters, null, 2) : "{}"
  )
  const [localError, setLocalError] = useState<string | null>(null)

  function onSubmit() {
    setLocalError(null)
    const params = parseParameters(parameters)
    if (!params.ok) {
      setLocalError(params.error)
      return
    }
    const fields = {
      ruleKey,
      name,
      description,
      ruleType,
      action,
      enabled,
      parameters: params.value,
    }

    void (async () => {
      try {
        const ok = await stepUp.run(() =>
          isEdit
            ? update
                .mutateAsync({ id: rule.id, input: buildUpdateBody(fields) })
                .then(() => undefined)
            : create.mutateAsync(buildCreateBody(fields)).then(() => undefined)
        )
        if (ok) onClose()
      } catch (error) {
        setLocalError(toErrorMessage(error))
      }
    })()
  }

  function onStepUpSuccess() {
    void stepUp
      .retry()
      .then((ok) => {
        if (ok) onClose()
      })
      .catch((error) => setLocalError(toErrorMessage(error)))
  }

  return {
    isEdit,
    me,
    stepUp,
    busy: create.isPending || update.isPending,
    localError,
    fields: {
      ruleKey,
      name,
      description,
      ruleType,
      action,
      enabled,
      parameters,
    },
    set: {
      ruleKey: setRuleKey,
      name: setName,
      description: setDescription,
      ruleType: setRuleType,
      action: setAction,
      enabled: setEnabled,
      parameters: setParameters,
    },
    onSubmit,
    onStepUpSuccess,
  }
}
