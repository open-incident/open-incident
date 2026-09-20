# The public surface is called by name from applications that shrink; keeping
# it means R8 does not remove a method whose only caller is the customer's code.
-keep public class dev.openincident.rum.OpenIncidentRum { public *; }
