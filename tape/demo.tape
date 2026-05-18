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

# `refactron login` boots the app. If you're not authenticated it shows the
# OAuth device-flow UI; if you are (as on this host), it skips straight to
# the REPL. From the REPL the verbs are bare (analyze, run, document), no
# `refactron ` prefix.
Type "refactron login"
Enter
Sleep 3s

Type "analyze ."
Enter
Sleep 4s

Type "run --dry-run ."
Enter
Sleep 5s

Type "run --apply ."
Enter
Sleep 11s

Type "exit"
Enter
Sleep 500ms

# Clean up before the recording ends so subsequent reruns from the same
# checkout don't see the mutated fixture.
Hide
Type "cd - && rm -rf /tmp/refactron-demo"
Enter
Show
