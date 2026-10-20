using System;
using System.IO;
using System.Linq;
using Xunit;

namespace Ohho.Schemas.Tests
{
    public class DescriptorGoldenVectorTests
    {
        private static string SchemaRoot()
        {
            DirectoryInfo dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null)
            {
                string candidate = Path.Combine(dir.FullName, "packages", "schemas", "ohho.descriptor.v1");
                if (Directory.Exists(candidate))
                {
                    return candidate;
                }
                dir = dir.Parent;
            }
            throw new DirectoryNotFoundException("ohho.descriptor.v1 schema root not found");
        }

        private static string[] Files(string bucket)
        {
            string dir = Path.Combine(SchemaRoot(), "vectors", "descriptor", bucket);
            return Directory.GetFiles(dir, "*.json").OrderBy(path => path, StringComparer.Ordinal).ToArray();
        }

        [Fact]
        public void ValidDescriptorsParse()
        {
            Assert.NotEmpty(Files("valid"));
            foreach (string file in Files("valid"))
            {
                RobotDescriptor msg = RobotDescriptor.Parse(File.ReadAllText(file));
                Assert.False(string.IsNullOrEmpty(msg.Id));
                Assert.True(msg.Safety.Hard.MaxVxMps <= 0.2d);
                Assert.True(msg.Safety.Hard.MaxVyMps <= 0.2d);
                Assert.True(msg.Safety.Hard.MaxWzRadS <= 1.0d);
                Assert.True(msg.Safety.Hard.MaxJointStepRad <= 0.15d);
            }
        }

        [Fact]
        public void InvalidDescriptorsAreRejected()
        {
            Assert.NotEmpty(Files("invalid"));
            var failures = new System.Collections.Generic.List<string>();
            foreach (string file in Files("invalid"))
            {
                string json = File.ReadAllText(file);
                if (Record.Exception(() => RobotDescriptor.Parse(json)) == null)
                {
                    failures.Add(Path.GetFileName(file));
                }
            }
            Assert.True(failures.Count == 0, string.Join(", ", failures));
        }

        [Fact]
        public void OmniBotDescriptorStaysAtTheCeiling()
        {
            string json = File.ReadAllText(Path.Combine(SchemaRoot(), "vectors", "descriptor", "valid", "omnibot.json"));
            RobotDescriptor msg = RobotDescriptor.Parse(json);
            Assert.Equal("omnibot", msg.Id);
            Assert.Equal("OmniBot", msg.Model);
            Assert.Equal(DescriptorDriveKind.Mecanum, msg.Drive.Kind);
            Assert.True(msg.Drive.Holonomic);
            Assert.Equal(0.2d, msg.Drive.Caps.VxMps);
            Assert.Equal(0.2d, msg.Safety.Hard.MaxVxMps);
            Assert.Equal(0.2d, msg.Safety.Hard.MaxVyMps);
            Assert.Equal(1.0d, msg.Safety.Hard.MaxWzRadS);
            Assert.Equal(0.15d, msg.Safety.Hard.MaxJointStepRad);
            Assert.Equal(0.8d, msg.Arms[0].Joints[5].Max);
            Assert.Equal(-0.1d, msg.Arms[0].Joints[5].Min);
            Assert.Empty(msg.Apriltags);
            Assert.Equal("/cmd_vel", msg.Topics.Cmd);
            Assert.Equal("/emergency_stop", msg.Topics.Estop);
            Assert.Equal("ohho.telemetry.v1", msg.Telemetry.SchemaId);
            Assert.Equal(DescriptorKind.Real, msg.Telemetry.Kind);
        }
    }
}
