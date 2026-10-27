using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json;
using Xunit;

namespace Ohho.Schemas.Tests
{
    public class GoldenVectorTests
    {
        private static string SchemaRoot()
        {
            DirectoryInfo dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                string candidate = Path.Combine(dir.FullName, "packages", "schemas", "ohho.telemetry.v1");
                if (Directory.Exists(candidate))
                {
                    return candidate;
                }
                dir = dir.Parent;
            }
            throw new DirectoryNotFoundException("ohho.telemetry.v1 schema root not found");
        }

        private static string[] Files(string kind, string bucket)
        {
            string dir = Path.Combine(SchemaRoot(), "vectors", kind, bucket);
            return Directory.GetFiles(dir, "*.json").OrderBy(path => path, StringComparer.Ordinal).ToArray();
        }

        [Fact]
        public void ValidTelemetryParses()
        {
            Assert.NotEmpty(Files("telemetry", "valid"));
            foreach (string file in Files("telemetry", "valid"))
            {
                TelemetryV1 msg = TelemetryV1.Parse(File.ReadAllText(file));
                Assert.False(string.IsNullOrEmpty(msg.RobotId));
            }
        }

        private static void AssertAllRejected(string kind, Action<string> parse)
        {
            var failures = new List<string>();
            foreach (string file in Files(kind, "invalid"))
            {
                string json = File.ReadAllText(file);
                if (Record.Exception(() => parse(json)) == null)
                {
                    failures.Add(Path.GetFileName(file));
                }
            }
            Assert.True(failures.Count == 0, string.Join(", ", failures));
        }

        [Fact]
        public void InvalidTelemetryIsRejected()
        {
            Assert.NotEmpty(Files("telemetry", "invalid"));
            AssertAllRejected("telemetry", json => TelemetryV1.Parse(json));
        }

        [Fact]
        public void ValidSafetyStateParses()
        {
            foreach (string file in Files("safety_state", "valid"))
            {
                SafetyState msg = SafetyState.Parse(File.ReadAllText(file));
                Assert.False(msg.SafetyFlagsAllowMotion());
            }
        }

        [Fact]
        public void InvalidSafetyStateIsRejected()
        {
            AssertAllRejected("safety_state", json => SafetyState.Parse(json));
        }

        [Fact]
        public void ValidHeartbeatParses()
        {
            foreach (string file in Files("heartbeat", "valid"))
            {
                Heartbeat msg = Heartbeat.Parse(File.ReadAllText(file));
                Assert.False(string.IsNullOrEmpty(msg.V));
            }
        }

        [Fact]
        public void InvalidHeartbeatIsRejected()
        {
            AssertAllRejected("heartbeat", json => Heartbeat.Parse(json));
        }

        [Fact]
        public void ValidHeartbeatEchoParses()
        {
            foreach (string file in Files("heartbeat_echo", "valid"))
            {
                HeartbeatEcho msg = HeartbeatEcho.Parse(File.ReadAllText(file));
                Assert.True(msg.T >= 0d);
            }
        }

        [Fact]
        public void InvalidHeartbeatEchoIsRejected()
        {
            AssertAllRejected("heartbeat_echo", json => HeartbeatEcho.Parse(json));
        }

        [Fact]
        public void SafetyFlagsFailClosed()
        {
            Assert.False(new TelemetryV1().SafetyFlagsAllowMotion());

            string root = Path.Combine(SchemaRoot(), "vectors", "telemetry", "valid");
            TelemetryV1 minimal = TelemetryV1.Parse(File.ReadAllText(Path.Combine(root, "minimal.json")));
            TelemetryV1 full = TelemetryV1.Parse(File.ReadAllText(Path.Combine(root, "full.json")));
            TelemetryV1 active = TelemetryV1.Parse(File.ReadAllText(Path.Combine(root, "estop_active.json")));
            TelemetryV1 latched = TelemetryV1.Parse(File.ReadAllText(Path.Combine(root, "estop_latched.json")));
            TelemetryV1 fault = TelemetryV1.Parse(File.ReadAllText(Path.Combine(root, "arm_fault.json")));

            Assert.False(minimal.SafetyFlagsAllowMotion());
            Assert.True(full.SafetyFlagsAllowMotion());
            Assert.False(active.SafetyFlagsAllowMotion());
            Assert.False(latched.SafetyFlagsAllowMotion());
            Assert.False(fault.SafetyFlagsAllowMotion());

            TelemetryV1 inconsistent = new TelemetryV1();
            inconsistent.Deadman = true;
            inconsistent.Estop = new EstopState();
            inconsistent.Estop.Active = false;
            inconsistent.Estop.Latched = false;
            inconsistent.Estop.Source = EstopSource.Hardware;
            inconsistent.Mode = new ModeState();
            inconsistent.Mode.Base = SubsystemMode.Teleop;
            inconsistent.Mode.Arm = SubsystemMode.NotPresent;
            Assert.False(inconsistent.SafetyFlagsAllowMotion());
        }

        [Fact]
        public void EchoCopiesSeqAndClientTime()
        {
            Heartbeat heartbeat = Heartbeat.Parse(
                File.ReadAllText(Path.Combine(SchemaRoot(), "vectors", "heartbeat", "valid", "typical.json")));
            HeartbeatEcho echo = HeartbeatEcho.Echo(heartbeat, 1735689601.5);
            Assert.Equal(heartbeat.Seq, echo.Seq);
            Assert.Equal(heartbeat.TClient, echo.TClient);
            Assert.Equal(heartbeat.V, echo.V);
            Assert.Equal(1735689601.5, echo.T);
            Assert.Throws<ArgumentOutOfRangeException>(() => HeartbeatEcho.Echo(heartbeat, -1d));
        }

        [Fact]
        public void FullSampleRoundTrips()
        {
            string json = File.ReadAllText(Path.Combine(SchemaRoot(), "vectors", "telemetry", "valid", "full.json"));
            TelemetryV1 msg = TelemetryV1.Parse(json);
            string again = JsonConvert.SerializeObject(msg, OhhoJson.Settings);
            TelemetryV1 parsed = TelemetryV1.Parse(again);
            Assert.Equal(msg.RobotId, parsed.RobotId);
            Assert.Equal(msg.Kind, parsed.Kind);
            Assert.Equal(msg.Deadman, parsed.Deadman);
            Assert.Equal("arm_joint_1", parsed.Joints[0].Name);
        }
    }
}
