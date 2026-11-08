I've rebased this directly onto post-0.5.0 `main` and narrowed it to the close command that is already executing when Samsung Home is selected.

Pending closes are cancelled, and launch waits for the tracked Ecore child to actually exit. A timeout requests termination but does not count as completion; an unrelated child's exit is also ignored. The implementation preserves the release's multiple Samsung Home targets and close schedule, including the CoBA path.

[Current CI passes](https://github.com/pponce/vetro/actions/runs/42507679989), including real Ecore child-process tests and a source build of the TV launcher. The combined test artifact contains the rebuilt DLL. The current isolated head has not been tested on S95C or Q80A; your Q80A comparison remains outstanding.
