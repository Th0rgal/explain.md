import Verity.Core

namespace Verity

theorem loop_preserves_core (n : Nat) : core_succ n := by
  exact core_succ n

theorem loop_keeps_bound (n : Nat) : dec n <= n := by
  exact dec_le_self n
