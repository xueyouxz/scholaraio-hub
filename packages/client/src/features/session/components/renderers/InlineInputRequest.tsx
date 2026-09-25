import type { InputRequest } from "@scholaraio-hub/shared";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { sessionApi } from "../../../../core/library";
import { Markdown } from "../../../../shared/components/Markdown";
import { field } from "./types";

type Decision = "approve" | "approve_accept_edits" | "deny";

interface Question {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  secret: boolean;
}

/** AskUserQuestion input, the shape both providers' questions arrive in. */
function questionsOf(request: InputRequest): Question[] {
  const list = (request.toolInput as { questions?: unknown } | undefined)?.questions;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const question = field(entry, "question");
    if (!question) return [];
    const options = (entry as { options?: unknown }).options;
    return [
      {
        question,
        header: field(entry, "header") || undefined,
        options: Array.isArray(options)
          ? options.flatMap((option) =>
              field(option, "label")
                ? [{ label: field(option, "label"), description: field(option, "description") }]
                : [],
            )
          : [],
        secret: (entry as { secret?: unknown }).secret === true,
      },
    ];
  });
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

/**
 * A pending decision asked on the row of the tool call it is about, the way
 * Claude Code asks in the transcript rather than in a detached dialog.
 */
export function InlineInputRequest({
  request,
  sessionId,
  onDone,
}: {
  request: InputRequest;
  sessionId: string;
  onDone: () => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const decide = useMutation({
    mutationFn: (decision: Decision) => sessionApi.input(sessionId, request.id, decision, answers),
    onSuccess: onDone,
  });
  const busy = decide.isPending;
  const button = (decision: Decision, label: string, primary = false) => (
    <button
      type="button"
      className={`inline-decision${primary ? " inline-decision-primary" : ""}`}
      disabled={busy}
      onClick={() => decide.mutate(decision)}
    >
      {label}
    </button>
  );

  if (request.toolName === "AskUserQuestion") {
    const questions = questionsOf(request);
    const complete = questions.every((question) => answers[question.question]?.trim());
    return (
      <fieldset className="inline-input" aria-label="Agent question">
        {questions.map((question) => (
          <fieldset key={question.question} className="inline-question">
            <legend>
              {question.header ? (
                <span className="inline-question-header">{question.header}</span>
              ) : null}
              {question.question}
            </legend>
            {question.options.length ? (
              <div className="inline-question-options">
                {question.options.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className="inline-option"
                    aria-pressed={answers[question.question] === option.label}
                    title={option.description || undefined}
                    onClick={() =>
                      setAnswers((current) => ({ ...current, [question.question]: option.label }))
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
            <input
              className="inline-question-text"
              type={question.secret ? "password" : "text"}
              autoComplete={question.secret ? "off" : undefined}
              aria-label={question.question}
              placeholder={question.options.length ? "Or type an answer" : "Type an answer"}
              value={answers[question.question] ?? ""}
              onChange={(event) =>
                setAnswers((current) => ({ ...current, [question.question]: event.target.value }))
              }
            />
          </fieldset>
        ))}
        <div className="inline-decisions">
          <button
            type="button"
            className="inline-decision inline-decision-primary"
            disabled={busy || !complete}
            onClick={() => decide.mutate("approve")}
          >
            Submit
          </button>
          {button("deny", "Skip")}
        </div>
        {decide.error ? <p className="text-error text-xs">{decide.error.message}</p> : null}
      </fieldset>
    );
  }

  if (request.toolName === "ExitPlanMode") {
    return (
      <fieldset className="inline-input" aria-label="Plan approval">
        <Markdown
          text={field(request.toolInput, "plan")}
          className="session-markdown inline-plan"
        />
        <div className="inline-decisions">
          {button("approve_accept_edits", "Yes, and auto-accept edits", true)}
          {button("approve", "Yes, approve each edit")}
          {button("deny", "No, keep planning")}
        </div>
        {decide.error ? <p className="text-error text-xs">{decide.error.message}</p> : null}
      </fieldset>
    );
  }

  return (
    <fieldset className="inline-input" aria-label="Permission request">
      <p className="inline-input-prompt">Allow this {request.toolName ?? "action"}?</p>
      <div className="inline-decisions">
        {button("approve", "Allow", true)}
        {request.toolName && EDIT_TOOLS.has(request.toolName)
          ? button("approve_accept_edits", "Allow and accept edits")
          : null}
        {button("deny", "Deny")}
      </div>
      {decide.error ? <p className="text-error text-xs">{decide.error.message}</p> : null}
    </fieldset>
  );
}
