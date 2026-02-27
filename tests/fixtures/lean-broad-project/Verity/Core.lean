namespace Verity

def inc (n : Nat) : Nat := n + 1

def dec (n : Nat) : Nat := n - 1

lemma inc_nonzero (n : Nat) : inc n > 0 := by
  exact Nat.succ_pos _

theorem core_succ (n : Nat) : inc n = Nat.succ n := by
  rfl

theorem dec_le_self (n : Nat) : dec n <= n := by
  exact Nat.sub_le _ _
