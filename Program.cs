using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using Microsoft.AspNetCore;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace TwilioApiApp
{
    public class Program
    {
        public static void Main(string[] args)
        {
            if (!isDevelopment())
            {
                BuildWebHost(args).Run();
            }
            else
            {
                BuildWebHostDev(args).Run();
            }
        }

        public static IWebHost BuildWebHost(string[] args) =>
            WebHost.CreateDefaultBuilder(args)
                .UseStartup<Startup>()
                .Build();

        public static IWebHost BuildWebHostDev(string[] args) =>
           WebHost.CreateDefaultBuilder(args)
               .UseKestrel((options) =>
               {

                   if (isDevelopment())
                   {
                       options.Listen(IPAddress.Loopback, 5008);
                       options.Listen(IPAddress.Loopback, 5009, listenOptions =>
                       {
                           listenOptions.UseHttps(@"C:\tmp\server.pfx", "amctechnology");
                       });
                   }
               })
               .UseStartup<Startup>()
               .Build();

        public static bool isDevelopment()
        {
            string environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT");
            return !string.IsNullOrEmpty(environment) && environment.Equals("Development");
        }
    }
}
