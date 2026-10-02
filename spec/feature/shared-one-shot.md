# Shared subscription CLI launch

The existing model selector invokes Claude through Lapilli's `@ludiars/one-shot`.
Lapilli owns Sonnet's default model ID, native executable resolution and account-auth
environment isolation. Famulus owns the prompt, candidate validation, 60-second deadline
and null-on-failure contract used by the deterministic selector fallback.

Initialize `lib/lapilli` before dependency installation. Its gitlink pins the library;
revert the consumer change and dependency pin together to restore the previous behavior.
This changes only the existing cloud-assisted selector, not the local Ollama spawner.
Tests and live CLI calls are left to the authorized review workflow.
