import Verity.Core

theorem loop_preserves (n : Nat) : core_safe n := by
  exact core_safe n

mutual
  theorem unsupported_demo : True := by
    trivial
end
