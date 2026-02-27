import Verity.Core
import Verity.Loop

namespace Verity

theorem invariant_chain (n : Nat) : dec (inc n) <= inc n := by
  exact dec_le_self (inc n)

theorem invariant_support (n : Nat) : loop_preserves_core n := by
  exact loop_preserves_core n
