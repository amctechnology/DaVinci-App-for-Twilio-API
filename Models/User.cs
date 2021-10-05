using System;

namespace TwilioApiApp.Models
{
    public class User
    {
        public Guid userid { get; set; }
        public string username { get; set; }
        public string firstname { get; set; }
        public string lastname { get; set; }
        public string email { get; set; }
        public int loglevel;
        public bool isActive { get; set; }
        public Guid roleid { get; set; }
        public string rolename { get; set; }
        public string accountname { get; set; }
        public Guid accountId { get; set; }
        public Guid profileid { get; set; }
        public string profilename { get; set; }
        public string customerId { get; set; }
        public bool hasLicense { get; set; }
        public User() { }

    }
}