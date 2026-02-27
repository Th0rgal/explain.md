namespace Verity

theorem a_cycle : True := by
  have h : True := c_cycle
  exact True.intro

theorem b_cycle : True := by
  have h : True := d_cycle
  exact True.intro

theorem c_cycle : True := by
  have h : True := b_cycle
  exact True.intro

theorem d_cycle : True := by
  have h : True := a_cycle
  exact True.intro
