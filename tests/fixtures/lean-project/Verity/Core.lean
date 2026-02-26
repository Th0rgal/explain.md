namespace Verity

def inc (n : Nat) : Nat := n + 1

lemma inc_nonzero (n : Nat) : inc n > 0 := by
  exact Nat.succ_pos _

theorem core_safe (n : Nat) : inc n = Nat.succ n := by
  rfl
