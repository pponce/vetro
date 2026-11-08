I've replaced the previous stacked implementation with a smaller proposal directly against post-0.5.0 `main`.

The release's native launcher modes now own physical Home: Samsung Home, Vetro overlay or Custom launcher. Launcher and Remapper edit that same saved destination. Mode changes validate the selected app, serialize changes and restore the previous mode if the change fails. Legacy physical Home rules remain stored but inactive, and new competing code-63 rules are refused. Other remapped keys remain independent.

This supersedes the previous `--mapped-home` design described above. It does not restore a second remapper-owned Home handler. Samsung Home stays enabled.

[Current CI passes](https://github.com/pponce/vetro/actions/runs/42507788092). I've kept this as a draft for agreement on ownership. Double press is prepared as a separate follow-up, and TV validation of this revised design is still outstanding.
