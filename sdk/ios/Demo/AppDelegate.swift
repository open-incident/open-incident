import UIKit
import OpenIncidentRUM

/// The smallest application that exercises every public call in the SDK.
///
/// Read it as the example it is: five lines start the reporting, and the rest
/// is one call per thing worth measuring. An application that adds only the
/// `start` gets sessions, cold start and whatever it catches; screens, actions
/// and network calls are one line each at the place that knows about them.
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        let environment = ProcessInfo.processInfo.environment
        OpenIncidentRUM.start(
            applicationId: environment["OI_APP"] ?? "",
            endpoint: URL(string: environment["OI_ENDPOINT"] ?? "http://localhost:4318")!,
            sampleRate: 1,
            service: "oi-demo-ios"
        )
        OpenIncidentRUM.identify("demo-user-42")

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = DemoViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}

final class DemoViewController: UIViewController {
    private let label = UILabel()
    private var taps = 0

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        label.text = "Open Incident RUM"
        label.textAlignment = .center
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)

        let button = UIButton(type: .system)
        button.setTitle("Ajouter au panier", for: .normal)
        button.addTarget(self, action: #selector(tap), for: .touchUpInside)
        button.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(button)

        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            button.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            button.topAnchor.constraint(equalTo: label.bottomAnchor, constant: 24),
        ])

        OpenIncidentRUM.screen("Home")
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        // A second screen, so `screen_load` has two calls to measure between.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            OpenIncidentRUM.screen("Checkout")
            OpenIncidentRUM.resource(
                url: "https://api.example.com/cart", method: "POST", status: 201, durationMs: 143
            )
            OpenIncidentRUM.error(
                type: "CheckoutError", message: "le paiement a été refusé",
                stack: "DemoViewController.pay()\nUIKit.sendAction"
            )
            OpenIncidentRUM.flush()
        }
    }

    @objc private func tap() {
        taps += 1
        label.text = "Panier : \(taps)"
        OpenIncidentRUM.action("add_to_cart", attributes: ["items": String(taps)])
        OpenIncidentRUM.flush()
    }
}
