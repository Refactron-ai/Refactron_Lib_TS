# tape/demo.tape — terminal recording for the README demo GIF.
# Generate: brew install vhs && vhs tape/demo.tape

Output docs/assets/demo.gif
Set FontSize 14
Set Width 960
Set Height 600
Set Theme "Dracula"
Set TypingSpeed 50ms
Set PlaybackSpeed 1.0

# Use a copy of the python-legacy-mini fixture as the demo target.
Hide
Type "cp -R fixtures/python-legacy-mini /tmp/refactron-demo && cd /tmp/refactron-demo"
Enter
Sleep 500ms
Show

Type "refactron analyze ."
Enter
Sleep 4s

Type "refactron run --dry-run ."
Enter
Sleep 5s

Type "refactron run --apply ."
Enter
Sleep 6s

Type "refactron document --apply"
Enter
Sleep 4s

# Clean up before the recording ends so subsequent reruns from the same
# checkout don't see the mutated fixture.
Hide
Type "cd - && rm -rf /tmp/refactron-demo"
Enter
Show
